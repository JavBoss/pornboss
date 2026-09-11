package clouddrive

import "strings"

type MissingPermissionsError struct {
	Permissions []string
}

func (e *MissingPermissionsError) Error() string {
	return "CloudDrive2 API token is missing permissions: " + strings.Join(e.Permissions, ", ")
}
