import { apiFetch } from "./client.js";

export async function fetchProfile() {
  return apiFetch("/profile");
}

export async function updateProfile({ deductorCategory }) {
  return apiFetch("/profile", {
    method: "PATCH",
    body: { deductorCategory },
  });
}
