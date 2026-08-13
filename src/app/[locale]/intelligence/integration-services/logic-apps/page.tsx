import { getTranslations } from "next-intl/server";
import IntegrationServiceScaffold from "../components/IntegrationServiceScaffold";

export default async function LogicAppsPage() {
  const t = await getTranslations("IntegrationServicesHub");

  return (
    <IntegrationServiceScaffold
      title={t("logicAppsTitle")}
      subtitle={t("logicAppsSubtitle")}
      crossMetadataTitle={t("crossMetadataTitle")}
      crossMetadataItems={[t("crossMeta1"), t("crossMeta2"), t("crossMeta3")]}
      mustHaveTitle={t("mustHaveTitle")}
      niceToHaveTitle={t("niceToHaveTitle")}
      mustHave={[t("logicAppsMust1"), t("logicAppsMust2"), t("logicAppsMust3"), t("logicAppsMust4")]}
      niceToHave={[t("logicAppsNice1"), t("logicAppsNice2"), t("logicAppsNice3")]}
      phaseOneTitle={t("phaseOneTitle")}
      phaseOneDesc={t("phaseOneDesc")}
      phaseTwoTitle={t("phaseTwoTitle")}
      phaseTwoDesc={t("phaseTwoDesc")}
      enterpriseConnectorsTitle={t("logicAppsEnterpriseTitle")}
      enterpriseConnectorsDesc={t("logicAppsEnterpriseDesc")}
    />
  );
}
