// Stop any running import (Market Data, automatic, workflow step) -- shared
// by the bottom bar, the Market Data grid and Settings -> Automatic Import.
// Backend: POST /api/data/import/stop/<task_id> (whoever started it or an admin).
import { toast } from "react-toastify";
import { apiClient } from "../../api/client";
import { isAdminUser } from "../../auth/Authorization";

export async function stopImport(taskId) {
  try {
    const { data } = await apiClient.post(`/api/data/import/stop/${taskId}`);
    toast.success(
      data.queued
        ? "Import cancelled before it started"
        : "Stopping the import: the companies in progress finish first; the rest can be resumed on Market Data"
    );
    return true;
  } catch (err) {
    toast.error(err.response?.data?.error || err.message);
    return false;
  }
}

/** Whoever started the job, or an admin, may stop it. */
export const canStopJob = (keycloak, startedBy) =>
  isAdminUser(keycloak) || (!!startedBy && keycloak?.tokenParsed?.sub === startedBy);
