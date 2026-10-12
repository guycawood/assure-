import { redirect } from "next/navigation";

// execution is part of the orders section, which has one About page.
export default function About() {
  redirect("/orders/about");
}