import { DIFFS_TAG_NAME } from "@pierre/diffs"
import type { HTMLAttributes } from "solid-js"

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      [DIFFS_TAG_NAME]: HTMLAttributes<HTMLElement>
    }
  }
}

export {}
