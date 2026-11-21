// The signed-in person of the harness comes from the address (?u=...), so one test can reload as the same person and as another one.
export const useAuth = () => ({ user: { id: new URLSearchParams(window.location.search).get('u') || 'u1' } });
