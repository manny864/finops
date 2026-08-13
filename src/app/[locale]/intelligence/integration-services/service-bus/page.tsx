import { getTranslations } from "next-intl/server";
import IntegrationServiceScaffold from "../components/IntegrationServiceScaffold";

export default async function ServiceBusPage() {
  const t = await getTranslations("IntegrationServicesHub");

  return (
    <IntegrationServiceScaffold
      title={t("serviceBusTitle")}
      subtitle={t("serviceBusSubtitle")}
      crossMetadataTitle={t("crossMetadataTitle")}
      crossMetadataItems={[t("crossMeta1"), t("crossMeta2"), t("crossMeta3")]}
      mustHaveTitle={t("mustHaveTitle")}
      niceToHaveTitle={t("niceToHaveTitle")}
      mustHave={[t("serviceBusMust1"), t("serviceBusMust2"), t("serviceBusMust3"), t("serviceBusMust4")]}
      niceToHave={[t("serviceBusNice1"), t("serviceBusNice2"), t("serviceBusNice3")]}
      phaseOneTitle={t("phaseOneTitle")}
      phaseOneDesc={t("phaseOneDesc")}
      phaseTwoTitle={t("phaseTwoTitle")}
      phaseTwoDesc={t("phaseTwoDesc")}
    />
  );
}
