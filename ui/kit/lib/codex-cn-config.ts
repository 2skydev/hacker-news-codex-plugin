import type { ConfigExtension } from "cn/config";

export const codexCnConfig = {
  extend: {
    theme: {
      "font-weight": ["base"],
      radius: ["page"],
      shadow: ["popup"],
    },
  },
} satisfies ConfigExtension;
