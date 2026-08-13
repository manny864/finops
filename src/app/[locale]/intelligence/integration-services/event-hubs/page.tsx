import { getTranslations } from "next-intl/server";
import IntegrationServiceScaffold from "../components/IntegrationServiceScaffold";

export default async function EventHubsPage() {
  const t = await getTranslations("IntegrationServicesHub");

  return (
    <IntegrationServiceScaffold
      title={t("eventHubsTitle")}
      subtitle={t("eventHubsSubtitle")}
      crossMetadataTitle={t("crossMetadataTitle")}
      crossMetadataItems={[t("crossMeta1"), t("crossMeta2"), t("crossMeta3")]}
      mustHaveTitle={t("mustHaveTitle")}
      niceToHaveTitle={t("niceToHaveTitle")}
      mustHave={[t("eventHubsMust1"), t("eventHubsMust2"), t("eventHubsMust3"), t("eventHubsMust4")]}
      niceToHave={[t("eventHubsNice1"), t("eventHubsNice2")]}
      phaseOneTitle={t("phaseOneTitle")}
      phaseOneDesc={t("phaseOneDesc")}
      phaseTwoTitle={t("phaseTwoTitle")}
      phaseTwoDesc={t("phaseTwoDesc")}
    />
  );
}
