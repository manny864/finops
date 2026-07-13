import CapturedSavingsBoard from "@/components/dashboard/CapturedSavingsBoard";
import MockBanner from "@/components/MockBanner";

export default function CapturedSavingsPage() {
    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <h1>Ahorro Capturado</h1>
                    <p>Tendencia histórica del ahorro potencial detectado y del desperdicio identificado en cada escaneo automatizado.</p>
                </div>
            </div>
            <div className="mt-6">
                <MockBanner />
                <CapturedSavingsBoard />
            </div>
        </div>
    );
}
