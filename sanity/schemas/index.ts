/** Every schema the Studio registers. Block objects first, then the documents that compose them. */
import { blockTypes } from "./blocks";
import { author } from "./author";
import { post } from "./post";
import { productContent } from "./productContent";

export const schemaTypes = [...blockTypes, productContent, post, author];
