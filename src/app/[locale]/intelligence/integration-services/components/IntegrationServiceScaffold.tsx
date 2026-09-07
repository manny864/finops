type IntegrationServiceScaffoldProps = {
  title: string;
  subtitle: string;
  mustHave: string[];
  niceToHave: string[];
  crossMetadataTitle: string;
  crossMetadataItems: string[];
  mustHaveTitle: string;
  niceToHaveTitle: string;
  phaseOneTitle: string;
  phaseOneDesc: string;
  phaseTwoTitle: string;
  phaseTwoDesc: string;
  enterpriseConnectorsTitle?: string;
  enterpriseConnectorsDesc?: string;
};

export default function IntegrationServiceScaffold({
  title,
  subtitle,
  mustHave,
  niceToHave,
  crossMetadataTitle,
  crossMetadataItems,
  mustHaveTitle,
  niceToHaveTitle,
  phaseOneTitle,
  phaseOneDesc,
  phaseTwoTitle,
  phaseTwoDesc,
  enterpriseConnectorsTitle,
  enterpriseConnectorsDesc,
}: IntegrationServiceScaffoldProps) {
  return (
    <div className="content animate-in fade-in px-6 py-8 space-y-6">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-800">{phaseOneTitle}</p>
        <p className="mt-1 text-sm text-emerald-700">{phaseOneDesc}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-600 mt-1">{subtitle}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">{crossMetadataTitle}</h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {crossMetadataItems.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">{mustHaveTitle}</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {mustHave.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">{niceToHaveTitle}</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {niceToHave.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </article>
      </section>

      {enterpriseConnectorsTitle && enterpriseConnectorsDesc && (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-indigo-900">{enterpriseConnectorsTitle}</h3>
          <p className="mt-2 text-sm text-indigo-800">{enterpriseConnectorsDesc}</p>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">{phaseTwoTitle}</h3>
        <p className="mt-2 text-sm text-slate-600">{phaseTwoDesc}</p>
      </section>
    </div>
  );
}
