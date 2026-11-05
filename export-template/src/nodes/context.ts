import { createContext } from "react";

/** Called with a node id when its expand/collapse control is pressed. */
export const ExpandContext = createContext<(id: string) => void>(() => {});
