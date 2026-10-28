export class AuthenticationRequiredError extends Error {
  constructor() { super("Authentication is required."); }
}

export class AuthorizationRequiredError extends Error {
  constructor() { super("You are not authorized to perform this action."); }
}
