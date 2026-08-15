import TagManager from "@/components/TagManager";
import MockBanner from "@/components/MockBanner";
import TagInheritancePanel from "@/components/dashboard/TagInheritancePanel";
import TaggingPoliciesManager from "@/components/TaggingPoliciesManager";

export default function TagsPage() {
  return (
    <div className="p-6">
      <MockBanner />
      <TaggingPoliciesManager />
      <TagManager />
      <TagInheritancePanel />
    </div>
  );
}
