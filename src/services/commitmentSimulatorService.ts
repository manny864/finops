/**
 * commitmentSimulatorService — Simulación "Savings Plan vs Reservation".
 *
 * Wrapper de compatibilidad que delega en commitmentRecommendations.service.ts.
 */
export {
    getSavingsPlanVsReservationComparison as getCommitmentSimulation,
    type CommitmentSimulationResponse as CommitmentSimulation,
} from "./commitmentRecommendations.service";

