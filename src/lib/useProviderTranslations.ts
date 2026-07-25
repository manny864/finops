"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useCloudProvider } from "@/context/ProviderContext";

/**
 * Traducciones sensibles al proveedor de nube activo.
 *
 * El problema que resuelve: el panel se parametriza en vez de forkearse (ver
 * docs/aws-multicloud-handoff.md §Fase 7), así que las mismas páginas sirven a
 * Azure y a AWS. Pero la terminología NO es intercambiable, y usar la de la
 * nube equivocada no es un detalle cosmético: erosiona la confianza en las
 * cifras. Un usuario de AWS que lee "Crecimiento de Cómputo (VMs/AKS)" o
 * "Suscripción" concluye, con razón, que la herramienta no entiende su nube.
 *
 * Cómo funciona: para cada clave se busca primero la variante `<clave>_aws`
 * cuando el proveedor activo es AWS, y se cae a la clave base si no existe. Eso
 * permite traducir sólo los términos que difieren de verdad (cuenta vs
 * suscripción, EKS vs AKS, BYOL vs AHB) sin duplicar diccionarios enteros, que
 * es lo que garantizaría que las dos mitades diverjan con el tiempo.
 *
 * Se implementa con un Proxy en vez de envolver la función a mano para no
 * perder `rich`, `markup` ni `raw`: son parte del contrato de next-intl y un
 * wrapper parcial rompería cualquier página que los use.
 *
 * Se mantiene la paridad de claves entre `en`, `es` y `pt-BR`: si se agrega una
 * variante `_aws`, va en los tres archivos.
 */
export function useProviderTranslations(namespace: string) {
    const t = useTranslations(namespace);
    const { activeProvider } = useCloudProvider();

    return useMemo(() => {
        const resolve = (key: unknown) => {
            if (activeProvider !== "aws" || typeof key !== "string") return key;
            const awsKey = `${key}_aws`;
            return t.has(awsKey as Parameters<typeof t.has>[0]) ? awsKey : key;
        };

        const withResolvedKey = (fn: (...args: unknown[]) => unknown) =>
            (...args: unknown[]) => fn(resolve(args[0]), ...args.slice(1));

        return new Proxy(t, {
            apply(target, thisArg, args: unknown[]) {
                return Reflect.apply(target as unknown as (...a: unknown[]) => unknown, thisArg, [
                    resolve(args[0]),
                    ...args.slice(1),
                ]);
            },
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (typeof value === "function" && (prop === "rich" || prop === "markup" || prop === "raw")) {
                    return withResolvedKey(value.bind(target) as (...args: unknown[]) => unknown);
                }
                return value;
            },
        });
    }, [t, activeProvider]);
}
