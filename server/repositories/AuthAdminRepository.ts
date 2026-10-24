import type { HeadDivision, Role } from '../../shared/contracts.js';
import type { MemberDetailsInput } from '../../shared/validation.js';
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
    technicalConsultant?: boolean;
    headDivision?: HeadDivision;
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
        provisioned_team_id: input.teamId ?? null,
        provisioned_head_division: input.headDivision ?? null,
        provisioned_technical_consultant: input.technicalConsultant === true
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
   * The client's panel login. `app_metadata.client_customer_id` (service key only)
   * keeps the database from creating a CRM profile for it. The password is hashed
   * by Supabase Auth and is neither stored nor returned by the CRM.
   */
  async createClientUser(input: { email: string; password: string; customerId: string; provisionedBy: string }): Promise<string> {
    const { data, error } = await getServiceClient().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: { client_customer_id: input.customerId, provisioned_by_consultant: input.provisionedBy }
    });
    if (error || !data.user) {
      if (/already (been )?registered|exists/i.test(error?.message || '')) {
        throw new AppError('CONFLICT', 'That e-mail already has a login. Use a different e-mail for the client.');
      }
      console.error('[api] auth.admin.createUser (client) failed', error?.message);
      throw new AppError('INTERNAL', 'Could not create the client login.');
    }
    return data.user.id;
  }

  /** Joining date, date of birth, blood group, emergency contact and designation (not readable by ordinary users). */
  async savePersonalDetails(userId: string, d: MemberDetailsInput): Promise<void> {
    const { error } = await getServiceClient().from('employee_personal_details').upsert({
      profile_id: userId,
      designation: d.designation,
      joining_date: d.joiningDate,
      date_of_birth: d.dateOfBirth,
      blood_group: d.bloodGroup,
      emergency_contact: d.emergencyContact,
      updated_at: new Date().toISOString()
    });
    if (error) {
      console.error('[api] saving personal details failed', error.code);
      throw new AppError('INTERNAL', 'Could not save the employee details.');
    }
  }

  /**
   * A one-time "set your password" link for a login (Supabase Auth recovery link). It opens
   * `redirectTo` signed in, where the user chooses their own password.
   */
  async passwordLink(email: string, redirectTo: string): Promise<string> {
    const { data, error } = await getServiceClient().auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
    const link = data?.properties?.action_link;
    if (error || !link) {
      console.error('[api] auth.admin.generateLink failed', error?.message);
      throw new AppError('INTERNAL', 'Could not make the set-password link.');
    }
    return link;
  }

  /** The client login behind an e-mail (for "Forgot password?"), or null. */
  async clientLoginForReset(email: string): Promise<{ email: string; name: string; businessName: string } | null> {
    const { data, error } = await getServiceClient().rpc('client_login_for_reset', { p_email: email });
    if (error) {
      console.error('[api] client_login_for_reset failed', error.message);
      throw new AppError('INTERNAL');
    }
    return (data as { email: string; name: string; businessName: string } | null) ?? null;
  }

  async deleteUser(userId: string): Promise<void> {
    await getServiceClient().auth.admin.deleteUser(userId);
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
