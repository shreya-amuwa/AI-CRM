import type { Role } from '../../shared/contracts.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';

const BAN_FOREVER = '876000h';

/**
 * Supabase Auth admin operations (service role). Callers MUST have authorised
 * the action through a database check first (see UserService).
 */
export class AuthAdminRepository {
  async createProvisionedUser(input: {
    email: string;
    password: string;
    fullName: string;
    position?: string | null;
    role: Role;
    departmentId?: string;
    teamId?: string;
    provisionedBy: string;
  }): Promise<string> {
    const { data, error } = await getServiceClient().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName, position: input.position ?? null },
      // app_metadata is writable only with the service key; the database
      // trigger re-validates that `provisioned_by` may grant this role.
      app_metadata: {
        provisioned_by: input.provisionedBy,
        provisioned_role: input.role,
        provisioned_department_id: input.departmentId ?? null,
        provisioned_team_id: input.teamId ?? null
      }
    });
    if (error || !data.user) {
      if (/already (been )?registered|exists/i.test(error?.message || '')) {
        throw new AppError('CONFLICT', 'A user with this e-mail already exists.');
      }
      console.error('[api] auth.admin.createUser failed', error?.message);
      throw new AppError('INTERNAL', 'Could not create the user account.');
    }
    return data.user.id;
  }

  /**
   * Block (or unblock) sign-in and token refresh. Database access is already
   * cut by RLS the moment status leaves ACTIVE; this additionally stops the
   * session from being renewed.
   */
  async setSignInBlocked(userId: string, blocked: boolean): Promise<void> {
    if (!hasServiceClient()) return;
    const { error } = await getServiceClient().auth.admin.updateUserById(userId, { ban_duration: blocked ? BAN_FOREVER : 'none' });
    if (error) console.warn('[api] could not update auth ban state', { userId, message: error.message });
  }
}
