<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api')]
class UserController extends AbstractController
{
    #[Route('/users', name: 'user_index', methods: ['GET'])]
    public function index(): JsonResponse
    {
        return $this->json([]);
    }

    #[Route('/users', name: 'user_store', methods: ['POST'])]
    public function store(): JsonResponse
    {
        return $this->json([], 201);
    }

    #[Route('/users/{id}', name: 'user_show', methods: ['GET'])]
    public function show(int $id): JsonResponse
    {
        return $this->json([]);
    }

    #[Route('/users/{id}', name: 'user_update', methods: ['PUT', 'PATCH'])]
    public function update(int $id): JsonResponse
    {
        return $this->json([]);
    }

    #[Route('/users/{id}', name: 'user_destroy', methods: ['DELETE'])]
    public function destroy(int $id): JsonResponse
    {
        return $this->json(null, 204);
    }
}
