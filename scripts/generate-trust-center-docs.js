/**
 * Genera los 4 documentos descargables del Centro de Confianza
 * (/legal/security → sección "Descargar Documentos"), en los 3 idiomas:
 *   - DPA (Art. 28 RGPD)
 *   - Whitepaper de Seguridad
 *   - Informe SOC 2 (readiness overview — aún no certificados, ver contenido)
 *   - Listado de Subencargados
 *
 * El contenido de DPA y Subencargados se arma directo desde messages/*.json
 * (LegalDpa / LegalSubprocessors) para no duplicar/desincronizar el texto que
 * ya se muestra en el sitio. El Whitepaper reusa LegalSecurity. El SOC 2 es
 * contenido propio (no existe un audit real todavía — ver LegalSecurity
 * badgeSoc2Subtitle "Meta Q3 2027"), redactado como resumen de estado, NUNCA
 * como si fuera un reporte de auditoría ya emitido.
 *
 * Salida: .md en docs/trust-center/ (fuente) + .pdf en docs/trust-center/ y
 * public/trust-center/ (servido a los clientes, mismo patrón que los
 * manuales de usuario — ver generate-manual-pdfs.js).
 */
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { chromium } = require('playwright');

const MESSAGES_DIR = path.join(process.cwd(), 'messages');
const OUT_DIR = path.join(process.cwd(), 'docs', 'trust-center');
const PUBLIC_DIR = path.join(process.cwd(), 'public', 'trust-center');

const LANGS = [
  { code: 'es', file: 'es.json', label: 'ES' },
  { code: 'en', file: 'en.json', label: 'EN' },
  { code: 'pt-BR', file: 'pt-BR.json', label: 'PT-BR' },
];

function loadMessages(lang) {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, lang.file), 'utf-8'));
}

function buildDpaMarkdown(m) {
  const t = m.LegalDpa;
  return `# ${t.title}

${t.subtitle}

## ${t.s1Title}
- ${t.s1Controller}
- ${t.s1Processor}
- ${t.s1PersonalData}
- ${t.s1Processing}

## ${t.s2Title}
- ${t.s2SubjectMatter}
- ${t.s2Duration}
- ${t.s2Nature}
- ${t.s2Purpose}

## ${t.s3Title}
**${t.s3SubjectsLabel}**
- ${t.s3Subject1}
- ${t.s3Subject2}
- ${t.s3Subject3}

**${t.s3CategoriesLabel}**
- ${t.s3Category1}
- ${t.s3Category2}
- ${t.s3Category3}
- ${t.s3Category4}

## ${t.s4Title}
${t.s4Intro}

| Subencargado | Finalidad |
|---|---|
| Microsoft Azure | ${t.s4Row1Purpose} |
| MySQL Provider | ${t.s4Row2Purpose} |
| Paddle | ${t.s4Row3Purpose} |
| WorkOS | ${t.s4Row4Purpose} |

## ${t.s5Title}
${t.s5BodyBefore}privacy@cscloudsolutions.com.ar${t.s5BodyAfter}

## ${t.s6Title}
${t.s6Intro}
- ${t.s6Bullet1}
- ${t.s6Bullet2}
- ${t.s6Bullet3}
- ${t.s6Bullet4}
- ${t.s6Bullet5}

## ${t.s7Title}
${t.s7Body}

## ${t.s8Title}
${t.s8Body}

## ${t.annex1Title}
${t.annex1Before}${t.annex1LinkText} (finops.cscloudsolutions.com/legal/subprocessors).

## ${t.annex2Title}
- ${t.annex2Technical}
- ${t.annex2Organizational}
- ${t.annex2Details}

---
${t.footerLastUpdated.replace('{date}', new Date().toLocaleDateString())}
`;
}

function buildSubprocessorsMarkdown(m) {
  const t = m.LegalSubprocessors;
  return `# ${t.title}

${t.subtitle}

> ${t.noteBefore}${t.noteBody}

## ${t.residencyTitle}
${t.residencyBody}

- ${t.residencyRegionLabel}: ${t.residencyRegionValue}

${t.residencyPlannedBefore}${t.residencyPlannedBody}

## ${t.detailsTitle}

| ${t.colProcessor} | ${t.colPurpose} | ${t.colLocations} |
|---|---|---|
| Microsoft Azure | ${t.procAzurePurpose} | ${t.locBrazil} |
| ${t.procMysqlName} | ${t.procMysqlPurpose} | ${t.locBrazil} |
| Paddle | ${t.procPaddlePurpose} | ${t.locUS} / ${t.locUK} |
| WorkOS | ${t.procWorkosPurpose} | ${t.locUS} |
| ${t.procGeminiName} | ${t.procGeminiPurpose} | ${t.locUS} |
| ${t.procGraphName} | ${t.procGraphPurpose} | ${t.locUS} |

${t.detailProtection}
${t.detailDpaAvailable}

## ${t.changePolicyTitle}
${t.changePolicyIntro}
- ${t.changeBullet1}
- ${t.changeBullet2}
- ${t.changeBullet3}

## ${t.questionsTitle}
${t.questionsBodyBefore}privacy@cscloudsolutions.com.ar

## ${t.relatedTitle}
- ${t.relatedPrivacy}
- ${t.relatedDpa}
- ${t.relatedSecurity}
`;
}

function buildWhitepaperMarkdown(m) {
  const t = m.LegalSecurity;
  return `# ${t.heroTitle}

${t.heroSubtitle}

## ${t.complianceStatusTitle}
- ${t.badgeGdprTitle} — ${t.badgeGdprSubtitle}
- ${t.badgeSoc2Title} — ${t.badgeSoc2Subtitle}
- ${t.badgeAzureTitle} — ${t.badgeAzureSubtitle}
- ${t.badgeIsoTitle} — ${t.badgeIsoSubtitle}

## ${t.encryptionTitle}
**${t.encryptionTransitTitle}**: ${t.encryptionTransitBody}

**${t.encryptionRestTitle}**: ${t.encryptionRestBody}

## ${t.accessTitle}
- ${t.accessAuth}
- ${t.accessAuthz}
- ${t.accessSso}
- ${t.accessSession}

## ${t.infraTitle}
- ${t.infraProvider}
- ${t.infraDb}
- ${t.infraDr}
- ${t.infraSla}

## ${t.auditTitle}
- ${t.auditLogs}
- ${t.auditMonitoring}
- ${t.auditIntrusion}

## ${t.subprocessorsTitle}
${t.subprocessorsIntro}

| ${t.procColProcessor} | ${t.procColPurpose} | ${t.procColLocation} |
|---|---|---|
| Microsoft Azure | ${t.procRow1Purpose} | Brazil South |
| Paddle | ${t.procRow2Purpose} | US/UK |
| WorkOS | ${t.procRow3Purpose} | US |
| Google Gemini AI | ${t.procRow4Purpose} | US |

## ${t.incidentTitle}
- ${t.incidentResponse}
- ${t.incidentNotification}
`;
}

const SOC2_CONTENT = {
  es: {
    title: 'Informe SOC 2 — Resumen de Estado',
    notice: '**Este documento es un resumen del estado de preparación de CSCloudSolutions para la certificación SOC 2 Tipo II. No es un reporte de auditoría emitido por un tercero independiente** — la certificación aún no se completó (meta: Q3 2027). El informe de auditoría formal estará disponible bajo NDA para clientes Enterprise una vez finalizada la auditoría.',
    sections: [
      ['Objetivo de certificación', 'SOC 2 Tipo II, meta Q3 2027.'],
      ['Controles de seguridad ya implementados', '- Cifrado TLS 1.2+ en tránsito y AES-256 en reposo\n- RBAC y MFA obligatorio vía Microsoft Entra ID\n- Monitoreo de seguridad continuo y detección de intrusiones\n- Registros de auditoría conservados 7 años\n- Copias de seguridad georredundantes, RTO < 4 horas'],
      ['Próximos pasos hacia la certificación', '- Selección de auditor externo acreditado\n- Definición del período de observación (Type II requiere un mínimo de 6 meses de evidencia operativa)\n- Auditoría formal y emisión del reporte'],
      ['Contacto', 'Para más información sobre el estado actual de la auditoría, escribinos a privacy@cscloudsolutions.com.ar.'],
    ],
  },
  en: {
    title: 'SOC 2 Report — Status Overview',
    notice: '**This document is a status overview of CSCloudSolutions\' readiness for SOC 2 Type II certification. It is NOT an audit report issued by an independent third party** — certification has not yet been completed (target: Q3 2027). The formal audit report will be made available under NDA to Enterprise customers once the audit is complete.',
    sections: [
      ['Certification target', 'SOC 2 Type II, targeting Q3 2027.'],
      ['Security controls already in place', '- TLS 1.2+ encryption in transit and AES-256 at rest\n- RBAC and mandatory MFA via Microsoft Entra ID\n- Continuous security monitoring and intrusion detection\n- Audit logs retained for 7 years\n- Geo-redundant backups, RTO < 4 hours'],
      ['Next steps toward certification', '- Selection of an accredited external auditor\n- Definition of the observation period (Type II requires a minimum 6-month window of operating evidence)\n- Formal audit and report issuance'],
      ['Contact', 'For more information on our current audit status, reach out to privacy@cscloudsolutions.com.ar.'],
    ],
  },
  'pt-BR': {
    title: 'Relatório SOC 2 — Resumo de Status',
    notice: '**Este documento é um resumo do status de preparação da CSCloudSolutions para a certificação SOC 2 Tipo II. NÃO é um relatório de auditoria emitido por um terceiro independente** — a certificação ainda não foi concluída (meta: 3º trimestre de 2027). O relatório de auditoria formal estará disponível sob NDA para clientes Enterprise assim que a auditoria for concluída.',
    sections: [
      ['Meta de certificação', 'SOC 2 Tipo II, com meta para o 3º trimestre de 2027.'],
      ['Controles de segurança já implementados', '- Criptografia TLS 1.2+ em trânsito e AES-256 em repouso\n- RBAC e MFA obrigatório via Microsoft Entra ID\n- Monitoramento de segurança contínuo e detecção de intrusões\n- Registros de auditoria retidos por 7 anos\n- Backups geo-redundantes, RTO < 4 horas'],
      ['Próximos passos rumo à certificação', '- Seleção de um auditor externo credenciado\n- Definição do período de observação (Tipo II exige no mínimo 6 meses de evidência operacional)\n- Auditoria formal e emissão do relatório'],
      ['Contato', 'Para mais informações sobre o status atual da auditoria, escreva para privacy@cscloudsolutions.com.ar.'],
    ],
  },
};

function buildSoc2Markdown(langCode) {
  const c = SOC2_CONTENT[langCode];
  const body = c.sections.map(([heading, text]) => `## ${heading}\n${text}`).join('\n\n');
  return `# ${c.title}\n\n> ${c.notice}\n\n${body}\n`;
}

function wrapHtml(bodyHtml, lang) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1f2430;
    line-height: 1.55;
    font-size: 11.5px;
  }
  h1 { font-size: 22px; color: #0054A6; border-bottom: 3px solid #00AEEF; padding-bottom: 8px; margin-top: 0; }
  h2 { font-size: 15px; color: #0054A6; margin-top: 22px; border-bottom: 1px solid #c7e2f5; padding-bottom: 4px; page-break-after: avoid; }
  p { margin: 6px 0; }
  strong { color: #003a73; }
  blockquote {
    border-left: 4px solid #f0ad4e;
    background: #fff8ec;
    margin: 10px 0;
    padding: 8px 14px;
    color: #6b4a12;
    font-size: 11px;
    page-break-inside: avoid;
  }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 10.5px; page-break-inside: avoid; }
  th, td { border: 1px solid #c7e2f5; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: #0054A6; color: white; }
  tr:nth-child(even) { background: #f4f9fd; }
  hr { border: none; border-top: 1px solid #c7e2f5; margin: 20px 0; }
  ul, ol { margin: 6px 0; padding-left: 22px; }
  li { margin: 2px 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const browser = await chromium.launch();

  const docs = [];
  for (const lang of LANGS) {
    const m = loadMessages(lang);
    docs.push({ name: `DPA_${lang.label}`, lang: lang.code, md: buildDpaMarkdown(m) });
    docs.push({ name: `SECURITY_WHITEPAPER_${lang.label}`, lang: lang.code, md: buildWhitepaperMarkdown(m) });
    docs.push({ name: `SOC2_REPORT_${lang.label}`, lang: lang.code, md: buildSoc2Markdown(lang.code) });
    docs.push({ name: `SUBPROCESSORS_${lang.label}`, lang: lang.code, md: buildSubprocessorsMarkdown(m) });
  }

  for (const doc of docs) {
    const mdPath = path.join(OUT_DIR, `${doc.name}.md`);
    fs.writeFileSync(mdPath, doc.md, 'utf-8');

    const html = wrapHtml(marked.parse(doc.md), doc.lang);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfPath = path.join(OUT_DIR, `${doc.name}.pdf`);
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '22mm', bottom: '18mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="width:100%;font-size:8px;color:#999;text-align:center;padding-top:4px;">Página <span class="pageNumber"></span> de <span class="totalPages"></span> — CSCloudSolutions FinOps</div>',
    });
    await page.close();
    fs.copyFileSync(pdfPath, path.join(PUBLIC_DIR, `${doc.name}.pdf`));
    const size = (fs.statSync(pdfPath).size / 1024).toFixed(0);
    console.log(`OK: ${doc.name}.pdf (${size} KB)`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
