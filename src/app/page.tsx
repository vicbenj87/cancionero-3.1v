import { redirect } from "next/navigation";

// La aplicación del Cancionero vive como sitio estático en /public
// (index.html, editor.html, css/, js/) para no alterar su lógica original.
// La raíz "/" simplemente lleva a esa aplicación.
export default function HomePage() {
  redirect("/index.html");
}
