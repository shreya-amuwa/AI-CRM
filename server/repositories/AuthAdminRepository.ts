import type { HeadDivision, Role } from '../../shared/contracts.js';
import type { MemberDetailsInput } from '../../shared/validation.js';
import { getAnonClient, getServiceClient, hasServiceClient } from '../db/supabase.js';
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
    metaVerifier?: boolean;
    headDivision?: HeadDivision;
    /** An Operations Head is created as one from the start (the Super Admin only; the database re-checks the provisioning actor). */
    operationsHead?: boolean;
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
        provisioned_technical_consultant: input.technicalConsultant === true,
        provisioned_meta_verifier: input.metaVerifier === true,
        provisioned_operations_head: input.operationsHead === true
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
   * A candidate-portal account (public registration). Created already confirmed, with the `candidate_portal` marker the database uses to
   * recognise a candidate. It carries NO app_metadata, so it can never be provisioned as staff or as a client: the database trigger skips
   * staff provisioning for it. Nothing about the caller is trusted except what the schema validated.
   */
  async createCandidateUser(input: { email: string; password: string; name: string; phone: string }): Promise<string> {
    const { data, error } = await getServiceClient().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { candidate_portal: true, name: input.name, full_name: input.name, phone: input.phone }
    });
    if (error || !data.user) {
      if (/already (been )?registered|exists/i.test(error?.message || '') || error?.code === 'email_exists') {
        throw new AppError('CONFLICT', 'An account with this e-mail already exists. Sign in instead.');
      }
      if (error?.code === 'weak_password') throw new AppError('VALIDATION_ERROR', 'Choose a stronger password.');
      console.error('[api] auth.admin.createUser (candidate) failed', error?.status ?? error?.code);
      throw new AppError('INTERNAL', 'Could not create your account. Please try again.');
    }
    return data.user.id;
  }

  /**
   * An employee submitted for approval: the sign-in exists (so the person is one identity from the start) but the database creates only a PENDING profile
   * and an approval request for it, never an active account. `request_*` in app_metadata is writable only with the service key; the trigger re-validates it.
   */
  async createEmployeeRequestUser(input: {
    email: string; password: string; fullName: string; position?: string | null;
    role: 'DEPARTMENT_HEAD' | 'TEAM_HEAD' | 'TEAM_MEMBER'; operationsHead: boolean; departmentId: string; division?: string | null; employeeCode?: string | null; requestedBy: string;
  }): Promise<string> {
    const { data, error } = await getServiceClient().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName, position: input.position ?? null },
      app_metadata: {
        request_by: input.requestedBy,
        request_role: input.role,
        request_operations_head: input.operationsHead,
        request_department_id: input.departmentId,
        request_division: input.division ?? null,
        request_employee_code: input.employeeCode ?? null
      }
    });
    if (error || !data.user) {
      if (/already (been )?registered|exists/i.test(error?.message || '')) {
        throw new AppError('CONFLICT', 'A user with this e-mail already exists.');
      }
      console.error('[api] auth.admin.createUser (employee request) failed', error?.message);
      throw new AppError('INTERNAL', 'Could not create the employee request.');
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
      app_metadata: { client_customer_id: input.customerId, provisioned_by: input.provisionedBy }
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

  /**
   * Puts a new password on a client's login (a fresh temporary one for Accounts' resend, or the client's own choice). Hashed by Supabase Auth;
   * never stored, logged or returned by the CRM.
   */
  async setClientPassword(userId: string, password: string): Promise<void> {
    const { error } = await getServiceClient().auth.admin.updateUserById(userId, { password });
    if (error) {
      console.error('[api] auth.admin.updateUserById (client password) failed', error.status ?? error.code);
      throw new AppError('INTERNAL', 'Could not save the password.');
    }
  }

  /** An employee chooses their own password (hashed by Supabase Auth; never stored, logged or returned by the CRM) and the welcome e-mail is closed. */
  async setStaffPassword(userId: string, password: string): Promise<void> {
    const { error } = await getServiceClient().auth.admin.updateUserById(userId, { password });
    if (error) {
      console.error('[api] auth.admin.updateUserById (staff password) failed', error.status ?? error.code);
      throw new AppError('INTERNAL', 'Could not save the password.');
    }
    const { error: markError } = await getServiceClient().rpc('welcome_email_setup_done', { p_user: userId });
    // the password is already saved; only the bookkeeping failed
    if (markError) console.error('[api] welcome_email_setup_done failed', markError.message);
  }

  /** The account is completely created: its (held) welcome e-mail may go now. Never fails the creation. */
  async releaseWelcomeEmail(userId: string): Promise<void> {
    const { error } = await getServiceClient().rpc('welcome_email_release', { p_employee: userId });
    if (error) console.error('[api] welcome_email_release failed', error.message);
  }

  /** True when `password` already signs this e-mail in (so a client cannot "choose" the temporary password again). */
  async passwordSignsIn(email: string, password: string): Promise<boolean> {
    const { data, error } = await getAnonClient().auth.signInWithPassword({ email, password });
    if (data?.session) await getAnonClient().auth.signOut().catch(() => undefined);
    return !error && !!data?.session;
  }

  /** Stored by the database once the client's own password is in place: the temporary one stops being required. */
  async clientPasswordChanged(userId: string): Promise<void> {
    const { error } = await getServiceClient().rpc('client_password_changed', { p_user: userId });
    if (error) {
      console.error('[api] client_password_changed failed', error.message);
      throw new AppError('INTERNAL', 'Could not finish changing the password.');
    }
  }

  /** A sign-in an earlier, interrupted attempt left for this customer and e-mail (so the retry finishes it instead of making a second one). */
  async clientUserFor(customerId: string, email: string): Promise<string | null> {
    const { data, error } = await getServiceClient().rpc('client_auth_user_for', { p_customer: customerId, p_email: email });
    if (error) {
      console.error('[api] client_auth_user_for failed', error.message);
      throw new AppError('INTERNAL', 'Could not check for an existing login.');
    }
    return (data as string | null) ?? null;
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
      contact_number: d.contactNumber,
      updated_at: new Date().toISOString()
    });
    if (error) {
      console.error('[api] saving personal details failed', error.code);
      throw new AppError('INTERNAL', 'Could not save the employee details.');
    }
  }

  /**
   * A one-time "set your password" link for a login (Supabase Auth recovery token). The link points straight at OUR page
   * (`redirectTo`?token_hash=...&type=recovery) and the page exchanges the token for a session when the client saves their password.
   * It does not go through Supabase's own redirect, so it does not depend on Supabase's Site URL / Redirect URLs settings (a wrong one sent
   * clients to localhost), and an e-mail scanner that only opens the link cannot use the token up (nothing is verified until the button is pressed).
   */
  async passwordLink(email: string, redirectTo: string): Promise<string> {
    const { data, error } = await getServiceClient().auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
    const token = data?.properties?.hashed_token;
    if (error || !token) {
      console.error('[api] auth.admin.generateLink failed', error?.message);
      throw new AppError('INTERNAL', 'Could not make the set-password link.');
    }
    const url = new URL(redirectTo);
    url.searchParams.set('token_hash', token);
    url.searchParams.set('type', 'recovery');
    return url.toString();
  }

  /** The ACTIVE employee behind an e-mail (staff "Forgot password?"), or null. Service role only (20261231000700). */
  async staffLoginForReset(email: string): Promise<{ id: string; email: string; name: string } | null> {
    const { data, error } = await getServiceClient().rpc('staff_login_for_reset', { p_email: email });
    if (error) {
      console.error('[api] staff_login_for_reset failed', error.message);
      throw new AppError('INTERNAL');
    }
    return (data as { id: string; email: string; name: string } | null) ?? null;
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
