import { notFound } from "next/navigation";
import { authenticatedUser } from "@/lib/auth";
import { OperationsDashboard } from "./operations";
export default async function AdminPage() { const user = await authenticatedUser(); if (!user || !(user.app_metadata?.role === "admin" || (Array.isArray(user.app_metadata?.roles) && user.app_metadata.roles.includes("admin")))) notFound(); return <OperationsDashboard />; }
