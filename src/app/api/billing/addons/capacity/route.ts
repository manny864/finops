import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getPaddleBaseUrl } from "@/lib/paddleTierMap";
import { normalizeTier } from "@/lib/tierLogic";
import { getAddonPriceIdMap, getAddonPriceIdForTier, type CapacityAddon } from "@/lib/paddleAddons";
import { getModulePrices } from "@/services/paddlePrices.service";
import { ADDON_CATALOG } from "@/lib/addonCatalog";
import { ADDON_PRICE_USD } from "@/lib/pricing";
import { getEffectiveSubscriptionLimit, countStoredSubscriptions } from "@/lib/subscriptionQuota";

export const dynamic = "force-dynamic";

/**
 * Autoservicio de add-ons de capacidad.
 *
 * POR QUÉ UN PATCH A LA SUSCRIPCIÓN Y NO UN CHECKOUT
 * El overlay de Paddle (el que usa PricingPage) abre una compra NUEVA. Un
 * add-on tiene que ser un ítem de la suscripción que el tenant YA tiene: si
 * naciera como suscripción aparte, el webhook no lo vería en
 * `subscription.updated` de la suscripción del plan y la capacidad nunca se
 * acreditaría. Por eso se modifica la suscripción existente y se deja que
 * Paddle prorratee.
 *
 * El alta de capacidad no la escribe esta ruta: la escribe el webhook al
 * recibir `subscription.updated`. Así la capacidad sólo sube cuando Paddle
 * confirma el cambio, y no si el PATCH falla a mitad de camino.
 */

const ADDON_LABEL: Record<CapacityAddon, string> = {
  additional_tenant_slot: "tenant adicional",
  additional_subscription_slot: "suscripción adicional",
};

/** GET: capacidad actual, para que la UI muestre en qué está parado el tenant. */
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    const [rows]: any = await pool.query(
      `SELECT t.tier, t.additional_tenant_slots, t.paddle_subscription_id,
              ts.purchased_subscription_slots
         FROM Tenants t
         LEFT JOIN TenantSubscriptions ts ON ts.tenant_id = t.tenant_id
        WHERE t.tenant_id = ? LIMIT 1`,
      [tenantId]
    );
    if (!rows?.[0]) return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });

    const tier = normalizeTier(rows[0].tier) || "Professional";
    const [limit, used] = await Promise.all([
      getEffectiveSubscriptionLimit(tenantId, tier),
      countStoredSubscriptions(tenantId),
    ]);

    // Best-effort: si Paddle no responde queda el fallback del catalogo. Nunca
    // se muestra "sin precio" por una caida del proveedor.
    let precioSuscripcion = ADDON_CATALOG.quota_subscriptions.basePriceUSD.monthly;
    try {
      const live = await getModulePrices();
      precioSuscripcion = live.modules.quota_subscriptions?.monthly ?? precioSuscripcion;
    } catch {
      /* fallback del catalogo */
    }

    return NextResponse.json({
      success: true,
      tier,
      subscriptions: {
        used,
        limit: Number.isFinite(limit) ? limit : null, // null = ilimitado
        purchased: Number(rows[0].purchased_subscription_slots) || 0,
      },
      tenantSlots: { purchased: Number(rows[0].additional_tenant_slots) || 0 },
      // El precio viaja en la respuesta, no lo escribe el cliente: la
      // suscripcion adicional se cotiza desde Paddle, igual que en el
      // marketplace y en la pagina de planes. Antes la tarjeta tenia el numero
      // escrito y le mostraba $50 a Professional mientras el marketplace decia
      // $40 por lo mismo.
      prices: {
        subscription: precioSuscripcion,
        // El tenant adicional todavia no esta en ADDON_CATALOG, asi que sigue
        // saliendo de la tabla de precios de lista. Se unifica cuando entre.
        tenant: ADDON_PRICE_USD.extraTenant?.[tier] ?? null,
      },
      // Sin esto la UI no puede ofrecer la compra: no hay a qué suscripción
      // agregarle el ítem.
      canPurchase: Boolean(rows[0].paddle_subscription_id) && Object.keys(getAddonPriceIdMap()).length > 0,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[addons/capacity] GET:", errorMessage(err));
    return NextResponse.json({ error: "Error al leer la capacidad." }, { status: 500 });
  }
}

/** POST: fija la cantidad del add-on en la suscripción de Paddle. */
export async function POST(request: NextRequest) {
  try {
    const { tenantId, addonType, quantity } = await request.json();
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    // Comprar capacidad cambia lo que factura el cliente: no alcanza con leer.
    await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0 || qty > 100) {
      return NextResponse.json({ error: "Cantidad inválida (0 a 100)." }, { status: 400 });
    }

    const [rows]: any = await pool.query(
      "SELECT paddle_subscription_id, tier FROM Tenants WHERE tenant_id = ? LIMIT 1",
      [tenantId]
    );

    // El precio depende del TIER: una suscripción extra sale $50 en
    // Professional y $40 en Business. Cobrar el precio equivocado sería
    // facturar mal, así que se resuelve desde el tier del tenant y no desde
    // lo que mande el cliente. Enterprise no tiene precio por unidad: su
    // capacidad va en el contrato.
    const tier = normalizeTier(rows?.[0]?.tier) || "Professional";
    const priceId = getAddonPriceIdForTier(addonType as CapacityAddon, tier);
    if (!priceId) {
      return NextResponse.json(
        {
          error: tier === "Enterprise"
            ? "En Enterprise la capacidad se ajusta por contrato. Contactá a tu ejecutivo de cuenta."
            : "Ese add-on no está disponible para contratación en línea. Contactá a ventas.",
        },
        { status: 409 }
      );
    }

    const subscriptionId = rows?.[0]?.paddle_subscription_id;
    if (!subscriptionId) {
      return NextResponse.json(
        { error: "Este tenant no tiene una suscripción de Paddle activa a la cual agregar el add-on." },
        { status: 409 }
      );
    }

    const apiKey = process.env.PADDLE_API_KEY;
    if (!apiKey) {
      // NO se responde "seguí, es gratis": antes la ruta de tenants devolvía
      // `canAddDirectly: true` cuando faltaba la config, o sea regalaba la
      // capacidad ante un error de entorno.
      return NextResponse.json(
        { error: "El cobro no está configurado en este entorno. Contactá a ventas." },
        { status: 503 }
      );
    }

    // Se leen los ítems actuales para conservarlos: el PATCH de Paddle
    // REEMPLAZA la lista entera, así que mandar sólo el add-on borraría el plan.
    const baseUrl = getPaddleBaseUrl();
    const current = await fetch(`${baseUrl}/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const currentJson: any = await current.json();
    if (!current.ok) {
      console.error("[addons/capacity] Paddle GET subscription:", currentJson);
      return NextResponse.json({ error: "No se pudo leer la suscripción en Paddle." }, { status: 502 });
    }

    // Se filtra por ADD-ON y no por price ID puntual: un tenant que cambió de
    // plan puede arrastrar el precio del tier anterior, y dejarlo produciría
    // dos ítems del mismo add-on cobrándose los dos.
    const priceMap = getAddonPriceIdMap();
    const existing: any[] = currentJson?.data?.items || [];
    const items = existing
      .filter((it) => priceMap[it?.price?.id || it?.price_id] !== addonType)
      .map((it) => ({ price_id: it?.price?.id || it?.price_id, quantity: Number(it?.quantity) || 1 }));
    if (qty > 0) items.push({ price_id: priceId, quantity: qty });

    const patch = await fetch(`${baseUrl}/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items, proration_billing_mode: "prorated_immediately" }),
    });
    const patchJson: any = await patch.json();
    if (!patch.ok) {
      console.error("[addons/capacity] Paddle PATCH subscription:", patchJson);
      return NextResponse.json({ error: "Paddle rechazó el cambio de suscripción." }, { status: 502 });
    }

    // La capacidad la acredita el webhook al recibir `subscription.updated`.
    return NextResponse.json({
      success: true,
      message: qty === 0
        ? `Se dio de baja el add-on de ${ADDON_LABEL[addonType as CapacityAddon]}.`
        : `Add-on actualizado a ${qty} ${ADDON_LABEL[addonType as CapacityAddon]}(es). La capacidad se habilita en unos segundos.`,
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
    console.error("[addons/capacity] POST:", errorMessage(err));
    return NextResponse.json({ error: "Error al contratar el add-on." }, { status: 500 });
  }
}
