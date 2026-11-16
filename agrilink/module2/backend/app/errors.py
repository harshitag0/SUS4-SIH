"""Domain errors mapped to HTTP status codes by the app's exception handler."""


class DomainError(Exception):
    status = 400
    code = "invalid"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFound(DomainError):
    status = 404
    code = "not_found"


class Conflict(DomainError):
    """The request is valid but not allowed in the current workflow state."""
    status = 409
    code = "invalid_state"


class Forbidden(DomainError):
    status = 403
    code = "forbidden"
