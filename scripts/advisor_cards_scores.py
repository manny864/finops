import os

def modify_file(filepath, replacements):
    print(f"Modifying {filepath}...")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    original_content = content
    for old_str, new_str in replacements:
        if old_str not in content:
            print(f"WARNING: Could not find exact text match for replacement in {filepath}.")
            print(f"Looking for:\n{old_str[:150]}...")
            continue
        content = content.replace(old_str, new_str)
    
    if content != original_content:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Successfully modified {filepath}.")
    else:
        print(f"No changes made to {filepath}.")

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

    # 1. Update advisorCollector.ts
    collector_path = os.path.join(base_dir, "src/modules/collectors/azure/advisorCollector.ts")
    
    old_collector_scores = """    const scoresMap: Record<string, number> = {};

    for (const sub of subs) {
        const subId = sub.id;
        
        // Extraer Scores REST API
        try {
            const scoreRes = await fetch(`https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/advisorScores?api-version=2020-01-01`, {
                headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Accept-Language": locale }
            });
            if (scoreRes.ok) {
                const scoreData = await scoreRes.json();
                if (scoreData && scoreData.value && scoreData.value.length > 0) {
                    const score = scoreData.value[0].properties?.score;
                    if (score !== undefined) {
                        scoresMap[subId] = score;
                    }
                }
            }
        } catch (err) {
            console.warn(`Error reading scores for sub ${subId}:`, err);
        }"""

    new_collector_scores = """    const scoresMap: Record<string, Record<string, number>> = {};

    for (const sub of subs) {
        const subId = sub.id;
        
        // Extraer Scores REST API
        try {
            const scoreRes = await fetch(`https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Advisor/advisorScore?api-version=2023-01-01`, {
                headers: { "Authorization": `Bearer ${tokenResponse.token}`, "Accept-Language": locale }
            });
            if (scoreRes.ok) {
                const scoreData = await scoreRes.json();
                if (scoreData && scoreData.value && scoreData.value.length > 0) {
                    const subScores: Record<string, number> = {};
                    for (const item of scoreData.value) {
                        const name = item.name;
                        const score = item.properties?.lastRefreshedScore?.score;
                        if (name && score !== undefined) {
                            subScores[name] = score;
                        }
                    }
                    scoresMap[subId] = subScores;
                }
            }
        } catch (err) {
            console.warn(`Error reading scores for sub ${subId}:`, err);
        }"""

    collector_replacements = [
        (old_collector_scores, new_collector_scores)
    ]
    modify_file(collector_path, collector_replacements)

    # 2. Update AdvisorPanel.tsx
    panel_path = os.path.join(base_dir, "src/components/AdvisorPanel.tsx")
    
    old_panel_state = """  const [scores, setScores] = useState<Record<string, number>>({});"""
    new_panel_state = """  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});"""

    old_panel_metrics = """      let avgScoreStr = "N/A";
      if (Object.keys(scores).length > 0) {
          if (selectedSub === "all") {
              const vals = Object.values(scores);
              const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
              avgScoreStr = `${avg.toFixed(1)}%`;
          } else if (scores[selectedSub] !== undefined) {
              avgScoreStr = `${scores[selectedSub].toFixed(1)}%`;
          }
      }"""

    new_panel_metrics = """      let avgScoreStr = "N/A";
      if (Object.keys(scores).length > 0) {
          if (selectedSub === "all") {
              const advisorScores = Object.values(scores)
                  .map(s => s.Advisor)
                  .filter(v => v !== undefined && v !== null);
              if (advisorScores.length > 0) {
                  const avg = advisorScores.reduce((a, b) => a + b, 0) / advisorScores.length;
                  avgScoreStr = `${avg.toFixed(1)}%`;
              }
          } else if (scores[selectedSub]?.Advisor !== undefined) {
              avgScoreStr = `${scores[selectedSub].Advisor.toFixed(1)}%`;
          }
      }"""

    old_panel_card = """                            <div className="text-[10px] tracking-[0.6px] uppercase text-grey font-bold flex items-center justify-between">
                                <span>{cat.icon} {cat.name}</span>
                                <div className="relative group/tooltip ml-2 flex items-center z-10">
                                    <Info className="w-3 h-3 text-grey cursor-help" />
                                    <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-gray-800 text-xs text-white rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-20 font-normal normal-case tracking-normal">
                                        {cat.tooltip}
                                        <div className="absolute top-full right-2 border-4 border-transparent border-t-gray-800"></div>
                                    </div>
                                </div>
                            </div>"""

    new_panel_card = """                            <div className="text-[10px] tracking-[0.6px] uppercase text-grey font-bold flex items-center justify-between">
                                <span>{cat.icon} {cat.name}</span>
                                <div className="flex items-center gap-1.5">
                                    {cardScoreVal !== null ? (
                                        <span className={`text-[10px] font-bold p-[2px_6px] rounded-md border ${
                                            cardScoreVal >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            cardScoreVal >= 50 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                            'bg-rose-50 text-rose-700 border-rose-200'
                                        }`}>
                                            {cardScoreVal.toFixed(0)}%
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-bold p-[2px_6px] rounded-md border bg-gray-50 text-gray-400 border-gray-150">
                                            N/A
                                        </span>
                                    )}
                                    <div className="relative group/tooltip flex items-center z-10">
                                        <Info className="w-3.5 h-3.5 text-grey cursor-help" />
                                        <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-gray-800 text-xs text-white rounded opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-20 font-normal normal-case tracking-normal">
                                            {cat.tooltip}
                                            <div className="absolute top-full right-2 border-4 border-transparent border-t-gray-800"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>"""

    # We also need to add the computation of cardScoreVal before return in panel categories.map
    old_panel_map_return = """                    return (
                        <div key={cat.id}"""

    new_panel_map_return = """                    let cardScoreVal: number | null = null;
                    if (Object.keys(scores).length > 0) {
                        if (selectedSub === "all") {
                            const catScores = Object.values(scores)
                                .map(s => s[cat.id])
                                .filter(v => v !== undefined && v !== null);
                            if (catScores.length > 0) {
                                cardScoreVal = catScores.reduce((a, b) => a + b, 0) / catScores.length;
                            }
                        } else if (scores[selectedSub]?.[cat.id] !== undefined) {
                            cardScoreVal = scores[selectedSub][cat.id];
                        }
                    }

                    return (
                        <div key={cat.id}"""

    panel_replacements = [
        (old_panel_state, new_panel_state),
        (old_panel_metrics, new_panel_metrics),
        (old_panel_card, new_panel_card),
        (old_panel_map_return, new_panel_map_return)
    ]
    modify_file(panel_path, panel_replacements)

if __name__ == "__main__":
    main()
