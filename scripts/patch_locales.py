import json
import os

files = {
    'messages/en.json': {
        "title": "Contact Enterprise Sales",
        "fullName": "Full Name",
        "email": "Work Email",
        "company": "Company Name",
        "spend": "Monthly Cloud Spend",
        "requirements": "Additional Requirements",
        "submit": "Submit Request",
        "submitting": "Submitting...",
        "successTitle": "Request Received",
        "successMessage": "Our enterprise team will contact you shortly.",
        "invalidEmail": "Please enter a valid corporate email.",
        "error": "An error occurred. Please try again."
    },
    'messages/es.json': {
        "title": "Contactar a Ventas Enterprise",
        "fullName": "Nombre Completo",
        "email": "Email Corporativo",
        "company": "Nombre de la Empresa",
        "spend": "Gasto Mensual en Nube",
        "requirements": "Requisitos Adicionales",
        "submit": "Enviar Solicitud",
        "submitting": "Enviando...",
        "successTitle": "Solicitud Recibida",
        "successMessage": "Nuestro equipo enterprise se pondrá en contacto a la brevedad.",
        "invalidEmail": "Por favor ingrese un email corporativo válido.",
        "error": "Ocurrió un error. Por favor intente nuevamente."
    },
    'messages/pt-BR.json': {
        "title": "Contatar Vendas Enterprise",
        "fullName": "Nome Completo",
        "email": "Email Corporativo",
        "company": "Nome da Empresa",
        "spend": "Gasto Mensal em Nuvem",
        "requirements": "Requisitos Adicionais",
        "submit": "Enviar Solicitação",
        "submitting": "Enviando...",
        "successTitle": "Solicitação Recebida",
        "successMessage": "Nossa equipe enterprise entrará em contato em breve.",
        "invalidEmail": "Por favor, insira um email corporativo válido.",
        "error": "Ocorreu um erro. Por favor, tente novamente."
    }
}

for filepath, modal_data in files.items():
    if not os.path.exists(filepath): continue
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if "pricing" not in data:
        data["pricing"] = {}
    
    data["pricing"]["enterpriseModal"] = modal_data
    
    # ensure customPrice is defined if it doesn't exist
    if "customPrice" not in data["pricing"]:
        if "en" in filepath: data["pricing"]["customPrice"] = "Custom"
        elif "es" in filepath: data["pricing"]["customPrice"] = "Personalizado"
        else: data["pricing"]["customPrice"] = "Personalizado"
        
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

print("Locales patched successfully.")
