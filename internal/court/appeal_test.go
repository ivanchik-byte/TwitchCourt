package court

import (
	"stream-tribunal/internal/config"
	"stream-tribunal/internal/obs"
	"stream-tribunal/internal/safety"
	"testing"
)

func TestAppealDecisionSurvivesSnapshots(t *testing.T) {
	engine := NewEngine(config.DefaultConfig(), obs.NewHub(nil), nil, &castRecorder{}, safety.NewFilter(nil))
	engine.state = StateVerdict
	engine.currCase = &TrialCase{Mode: "unban", Appeal: &obs.AppealState{ID: "appeal-1"}}
	before := engine.Snapshot()
	engine.RecordAppealDecision("wrong", true)
	if engine.Snapshot().Appeal.Resolved {
		t.Fatal("unrelated appeal changed")
	}
	engine.RecordAppealDecision("appeal-1", true)
	after := engine.Snapshot()
	if after.Appeal.ID != "appeal-1" || !after.Appeal.Resolved || !after.Appeal.Approved {
		t.Fatalf("decision lost: %+v", after.Appeal)
	}
	if before.Appeal.Resolved {
		t.Fatal("previous immutable snapshot was mutated")
	}
}
