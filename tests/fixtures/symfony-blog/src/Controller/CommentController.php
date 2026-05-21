<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/comments')]
class CommentController extends AbstractController
{
    #[Route('', methods: ['GET'])]
    public function index(): JsonResponse { return $this->json([]); }

    #[Route('', methods: ['POST'])]
    public function create(): JsonResponse { return $this->json([], 201); }

    #[Route('/{id}', methods: ['DELETE'])]
    public function delete(int $id): JsonResponse { return $this->json(null, 204); }
}
