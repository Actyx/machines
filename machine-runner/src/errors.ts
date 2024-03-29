export class MachineRunnerError extends Error {
  // https://stackoverflow.com/questions/41102060/typescript-extending-error-class
  constructor(message?: string) {
    super(message)
    this.name = 'MachineRunnerError'
    Object.setPrototypeOf(this, MachineRunnerError.prototype)
  }
}

export class MachineRunnerErrorCommandFiredAfterLocked extends MachineRunnerError {
  constructor(message?: string) {
    super(message)
    this.name = 'MachineRunnerErrorCommandFiredAfterLocked'
    Object.setPrototypeOf(this, MachineRunnerErrorCommandFiredAfterLocked.prototype)
  }
}
export class MachineRunnerErrorCommandFiredAfterDestroyed extends MachineRunnerError {
  constructor(message?: string) {
    super(message)
    this.name = 'MachineRunnerErrorCommandFiredAfterDestroyed'
    Object.setPrototypeOf(this, MachineRunnerErrorCommandFiredAfterDestroyed.prototype)
  }
}
export class MachineRunnerErrorCommandFiredAfterExpired extends MachineRunnerError {
  constructor(message?: string) {
    super(message)
    this.name = 'MachineRunnerErrorCommandFiredAfterExpired'
    Object.setPrototypeOf(this, MachineRunnerErrorCommandFiredAfterExpired.prototype)
  }
}
export class MachineRunnerErrorCommandFiredWhenNotCaughtUp extends MachineRunnerError {
  constructor(message?: string) {
    super(message)
    this.name = 'MachineRunnerErrorCommandFiredWhenNotCaughtUp'
    Object.setPrototypeOf(this, MachineRunnerErrorCommandFiredWhenNotCaughtUp.prototype)
  }
}

export class MachineRunnerFailure extends MachineRunnerError {
  cause: unknown
  constructor(message?: string, cause?: unknown) {
    super(message)
    this.name = 'MachineRunnerFailure'
    this.cause = cause
    Object.setPrototypeOf(this, MachineRunnerFailure.prototype)
  }
}
