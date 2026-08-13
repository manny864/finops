import { getTranslations } from "next-intl/server";
import IntegrationServiceScaffold from "../components/IntegrationServiceScaffold";

export default async function ApimPage() {
  const t = await getTranslations("IntegrationServicesHub");

  return (
    <IntegrationServiceScaffold
      title={t("apimTitle")}
      subtitle={t("apimSubtitle")}
      crossMetadataTitle={t("crossMetadataTitle")}
      crossMetadataItems={[t("crossMeta1"), t("crossMeta2"), t("crossMeta3")]}
      mustHaveTitle={t("mustHaveTitle")}
      niceToHaveTitle={t("niceToHaveTitle")}
      mustHave={[t("apimMust1"), t("apimMust2"), t("apimMust3")]}
      niceToHave={[t("apimNice1"), t("apimNice2"), t("apimNice3")]}
      phaseOneTitle={t("phaseOneTitle")}
      phaseOneDesc={t("phaseOneDesc")}
      phaseTwoTitle={t("phaseTwoTitle")}
      phaseTwoDesc={t("phaseTwoDesc")}
    />
  );
}
