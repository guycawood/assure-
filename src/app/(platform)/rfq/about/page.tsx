import { redirect } from "next/navigation";

// rfq is part of the sourcing section, which has one About page.
export default function About() {
  redirect("/sourcing/about");
}