// La UI real de login NO vive acá: ClientShell.tsx intercepta cualquier ruta
// cuando no hay sesión (`if (!isAuthenticated)`) y renderiza su propia tarjeta
// de acceso, así que este page.tsx nunca llega a pintar nada. Se mantiene
// porque /login es la ruta a la que ClientShell hace router.replace() y a la
// que apuntan los links de los emails de auth.
export default function LoginPage() {
    return null;
}
