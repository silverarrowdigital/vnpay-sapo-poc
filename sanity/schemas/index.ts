/** Every schema the Studio registers. Block objects first, then the documents that compose them. */
import { blockTypes } from "./blocks";
import { productContent } from "./productContent";

export const schemaTypes = [...blockTypes, productContent];
