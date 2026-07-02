Fail the run with your error message, the explicit "this path is a bug"
marker. Inside a `core.flow.try` sub-workflow it becomes the `catch` branch's
error value, leaving the parent run to continue.
