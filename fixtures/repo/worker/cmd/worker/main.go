package main

import (
	"fmt"

	"example.com/shop/worker/internal/queue"
)

func main() {
	fmt.Println(queue.New())
}
