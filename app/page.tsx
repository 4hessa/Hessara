import Workspace from "./workspace";
import { authenticatedUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await authenticatedUser();
  return <Workspace sessionMode={user ? user.is_anonymous ? "guest" : "account" : "none"} />;
}
