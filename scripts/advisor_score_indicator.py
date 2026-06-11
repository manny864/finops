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

    # 1. directivas/azure_advisor_SOP.md - Update documentation
    sop_path = os.path.join(base_dir, "directivas/azure_advisor_SOP.md")
    sop_replacements = [
        (
            "- **Filtrado y Scores**: Las recomendaciones ahora se etiquetan con `subscriptionId`. Se hace fetch a la REST API de Microsoft.Advisor/advisorScores para promediar la puntuación general en el frontend.",
            "- **Filtrado y Scores**: Las recomendaciones ahora se etiquetan con `subscriptionId`. Se hace fetch a la REST API de Microsoft.Advisor/advisorScores para promediar la puntuación general en el frontend. El Advisor Score promedio se visualiza en la cabecera del panel usando insignias (badges) de color según su rango (Verde >= 80%, Amarillo >= 50%, Rojo < 50%, Gris N/A)."
        )
    ]
    modify_file(sop_path, sop_replacements)

    # 2. src/components/AdvisorPanel.tsx - Add color-coded Score indicator to header
    advisor_path = os.path.join(base_dir, "src/components/AdvisorPanel.tsx")
    
    old_avg_score_def = """      return { totalRecs, avgScoreStr };
  }, [filteredData, scores, selectedSub]);"""

    new_avg_score_def = """      return { totalRecs, avgScoreStr };
  }, [filteredData, scores, selectedSub]);

  // Determine Advisor Score Color Code
  const scoreNum = parseFloat(globalMetrics.avgScoreStr);
  let scoreBadgeColor = "bg-gray-100 text-gray-700 border-gray-200";
  if (!isNaN(scoreNum)) {
      if (scoreNum >= 80) {
          scoreBadgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";
      } else if (scoreNum >= 50) {
          scoreBadgeColor = "bg-amber-50 text-amber-700 border-amber-200";
      } else {
          scoreBadgeColor = "bg-rose-50 text-rose-700 border-rose-200";
      }
  }"""

    old_header_rendering = """            <div className="ml-auto flex gap-[9px] items-center flex-wrap">
                <span className="text-[11px] font-bold tracking-[0.4px] bg-[#E6F2FB] text-brand-deep px-[11px] py-[5px] rounded-lg">
                    📍 {selectedTenant.name}
                </span>"""

    new_header_rendering = """            <div className="ml-auto flex gap-[9px] items-center flex-wrap">
                <span className="text-[11px] font-bold tracking-[0.4px] bg-[#E6F2FB] text-brand-deep px-[11px] py-[5px] rounded-lg">
                    📍 {selectedTenant.name}
                </span>
                <span className={`text-[11px] font-bold tracking-[0.4px] px-[11px] py-[5px] rounded-lg border ${scoreBadgeColor}`}>
                    🏆 Advisor Score: {globalMetrics.avgScoreStr}
                </span>"""

    advisor_replacements = [
        (old_avg_score_def, new_avg_score_def),
        (old_header_rendering, new_header_rendering)
    ]
    modify_file(advisor_path, advisor_replacements)

if __name__ == "__main__":
    main()
