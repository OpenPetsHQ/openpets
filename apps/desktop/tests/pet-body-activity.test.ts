import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
require(join(process.env.OPENPETS_DESKTOP_ROOT ?? process.cwd(), "tests/pet-body-activity.test.cjs"));
