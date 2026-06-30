import TagManager from "@/components/TagManager";
import MockBanner from "@/components/MockBanner";
import TagInheritancePanel from "@/components/dashboard/TagInheritancePanel";

export default function TagsPage() {
  return (
    <div className="p-6">
      <MockBanner />
      <TagManager />
      <TagInheritancePanel />
    </div>
  );
}
