import { getTranslations } from "next-intl/server";
import IntegrationServiceScaffold from "../components/IntegrationServiceScaffold";

export default async function EventGridPage() {
  const t = await getTranslations("IntegrationServicesHub");

  return (
    <IntegrationServiceScaffold
      title={t("eventGridTitle")}
      subtitle={t("eventGridSubtitle")}
      crossMetadataTitle={t("crossMetadataTitle")}
      crossMetadataItems={[t("crossMeta1"), t("crossMeta2"), t("crossMeta3")]}
      mustHaveTitle={t("mustHaveTitle")}
      niceToHaveTitle={t("niceToHaveTitle")}
      mustHave={[t("eventGridMust1"), t("eventGridMust2"), t("eventGridMust3")]}
      niceToHave={[t("eventGridNice1"), t("eventGridNice2")]}
      phaseOneTitle={t("phaseOneTitle")}
      phaseOneDesc={t("phaseOneDesc")}
      phaseTwoTitle={t("phaseTwoTitle")}
      phaseTwoDesc={t("phaseTwoDesc")}
    />
  );
}
