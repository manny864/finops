import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("1. Diagnosticando y Parcheando la Directiva (Memoria Viva)...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/onboarding_SOP.md")
    
    # Read if exists, append if it does
    if os.path.exists(sop_path):
        with open(sop_path, "r") as f:
            sop_content = f.read()
    else:
        sop_content = "# Onboarding Script SOP\\n\\n## Objetivo\\nCrear App Registration y Service Principal para FinOps.\\n\\n"
    
    restriction_text = "### Restricciones/Casos Borde\\n- **Nota: No usar `-DisplayName` junto con `New-AzADAppCredential`, ni usar el ObjectId del Service Principal, porque causa el error 'Parameter set cannot be resolved'.** En su lugar, obtener la Application mediante `Get-AzADApplication -AppId $sp.AppId`, extraer su `Id` (Application Object ID), y pasarlo al parámetro `-ObjectId` junto con `-StartDate` y `-EndDate` únicamente.\\n"
    
    if "Parameter set cannot be resolved" not in sop_content:
        with open(sop_path, "a") as f:
            f.write("\\n" + restriction_text)

    print("2. Parcheando onboardingScriptTemplate.ts...")
    template_path = os.path.join(base_dir, "src/lib/onboardingScriptTemplate.ts")
    with open(template_path, "r") as f:
        content = f.read()

    # Old code:
    # $secretParams = @{
    #     ObjectId = $sp.Id
    #     DisplayName = "FinOpsAutomationSecret"
    #     StartDate = (Get-Date)
    #     EndDate = (Get-Date).AddYears(2)
    # }
    # $secret = New-AzADAppCredential @secretParams
    # $ClientSecret = $secret.SecretText

    # New code:
    # $app = Get-AzADApplication -AppId $sp.AppId
    # $secret = New-AzADAppCredential -ObjectId $app.Id -StartDate (Get-Date) -EndDate (Get-Date).AddYears(2)
    # $ClientSecret = $secret.SecretText
    
    old_code = """$secretParams = @{
    ObjectId = $sp.Id
    DisplayName = "FinOpsAutomationSecret"
    StartDate = (Get-Date)
    EndDate = (Get-Date).AddYears(2)
}
$secret = New-AzADAppCredential @secretParams
$ClientSecret = $secret.SecretText"""

    new_code = """# New-AzADAppCredential must target the Application Object ID, not the SP.
# Also, -DisplayName can conflict with other parameter sets.
$app = Get-AzADApplication -AppId $sp.AppId
$secret = New-AzADAppCredential -ObjectId $app.Id -StartDate (Get-Date) -EndDate (Get-Date).AddYears(2)
$ClientSecret = $secret.SecretText"""

    if old_code in content:
        content = content.replace(old_code, new_code)
        with open(template_path, "w") as f:
            f.write(content)
        print("Script parcheado exitosamente.")
    else:
        print("El código antiguo no se encontró. Posiblemente ya fue parcheado.")

if __name__ == "__main__":
    deploy()
