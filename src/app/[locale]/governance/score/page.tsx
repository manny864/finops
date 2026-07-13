import GovernanceScoreBoard from "@/components/dashboard/GovernanceScoreBoard";
import MockBanner from "@/components/MockBanner";

export default function GovernanceScorePage() {
    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <h1>Estado de Gobernanza</h1>
                    <p>Score de seguridad financiera basado en el cumplimiento de las políticas de etiquetado obligatorias, con detalle por etiqueta.</p>
                </div>
            </div>
            <div className="mt-6">
                <MockBanner />
                <GovernanceScoreBoard />
            </div>
        </div>
    );
}
