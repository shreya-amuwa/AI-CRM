// The signed-in employee for the chat harness (a Team Member, or the Super Admin), chosen by the test.
export const useAuth = () => ({ profile: (window as any).__profile, user: (window as any).__profile });
