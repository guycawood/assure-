import { redirect } from "next/navigation";

// logistics is part of the orders section, which has one About page.
export default function About() {
  redirect("/orders/about");
}