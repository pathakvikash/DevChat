import { renderOgImage } from "@/lib/ogImage";

export const alt = "Orrery, a multi-model AI chat workspace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return renderOgImage();
}
