import { body, bool, fail, handle, num, ok, str } from "@/lib/api";
import {
  addExtra,
  blankGroceryList,
  removeItem,
  setChecked,
  toPlainText,
  uncheckAll,
} from "@/lib/parse/grocery";
import { readGrocery } from "@/lib/store";
import * as vault from "@/lib/vault";

export async function GET() {
  return handle(async () => {
    const list = await readGrocery();
    return ok({ list, plain: toPlainText(list) });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await body<Record<string, unknown>>(request);
    const action = str(payload.action ?? "", "action");
    const rel = vault.FILES.groceryList;
    const fallback = blankGroceryList();

    switch (action) {
      case "check": {
        const line = num(payload.line, "line");
        const checked = bool(payload.checked, "checked");
        await vault.editFile(rel, fallback, (t) => setChecked(t, line, checked));
        return ok({ ok: true });
      }
      case "add": {
        const item = str(payload.item ?? "", "item");
        await vault.editFile(rel, fallback, (t) => addExtra(t, item));
        return ok({ ok: true });
      }
      case "remove": {
        const line = num(payload.line, "line");
        await vault.editFile(rel, fallback, (t) => removeItem(t, line));
        return ok({ ok: true });
      }
      case "uncheck-all": {
        await vault.editFile(rel, fallback, uncheckAll);
        return ok({ ok: true });
      }
      default:
        return fail(`Unknown action: ${action}`);
    }
  });
}
