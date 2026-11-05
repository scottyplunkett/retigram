package queue

type Queue struct{}

func New() *Queue { return &Queue{} }

func (q *Queue) Push(v string) {}
