package bot

import "testing"

func TestVoteCommandHasAnExactNameAndKeepsItsArgument(t *testing.T) {
	for _, text := range []string{"!vote 1", " !VOTE\t1 "} {
		command := ParseChatLine("viewer", text)
		if command.Kind != CommandVote || command.Argument != "1" {
			t.Fatal(command)
		}
	}
	if ParseChatLine("viewer", "!votex 1").Kind == CommandVote {
		t.Fatal("command prefix counted as a vote")
	}
	if ParseChatLine("viewer", "!vote 1 2").Argument != "1 2" {
		t.Fatal("extra arguments became a valid choice")
	}
}
