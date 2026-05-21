<?php
// Minimal stubs to satisfy phpstan when analysing generated code.
namespace Doctrine\Common\Collections {
    interface Collection extends \Countable, \IteratorAggregate {
        public function add($element);
        public function removeElement($element);
        public function contains($element): bool;
    }

    class ArrayCollection implements Collection {
        private array $items = [];
        public function __construct(array $elements = []) { $this->items = $elements; }
        public function add($element) { $this->items[] = $element; }
        public function removeElement($element) { $k = array_search($element, $this->items, true); if ($k !== false) unset($this->items[$k]); }
        public function contains($element): bool { return in_array($element, $this->items, true); }
        public function getIterator(): \ArrayIterator { return new \ArrayIterator($this->items); }
        public function count(): int { return count($this->items); }
    }
}

namespace Doctrine\ORM\Mapping {
    // Attribute stubs used by generated entities
    #[\Attribute(\Attribute::TARGET_CLASS | \Attribute::TARGET_PROPERTY)]
    class Entity { public function __construct() {} }

    #[\Attribute(\Attribute::TARGET_PROPERTY)]
    class Column { public function __construct(array $_args = []) {} }

    #[\Attribute(\Attribute::TARGET_PROPERTY)]
    class Id { public function __construct() {} }

    #[\Attribute(\Attribute::TARGET_PROPERTY)]
    class GeneratedValue { public function __construct() {} }

    #[\Attribute(\Attribute::TARGET_PROPERTY)]
    class ManyToOne { public function __construct(array $_args = []) {} }

    #[\Attribute(\Attribute::TARGET_PROPERTY)]
    class OneToMany { public function __construct(array $_args = []) {} }

    #[\Attribute(\Attribute::TARGET_PROPERTY)]
    class ManyToMany { public function __construct(array $_args = []) {} }

    #[\Attribute(\Attribute::TARGET_PROPERTY)]
    class JoinColumn { public function __construct(array $_args = []) {} }
}

namespace Illuminate\Http {
    class Request {
        public function integer(string $key, int $default = 0): int { return $default; }
        public function validated(): array { return []; }
        public function file(string $key) { return null; }
        public function query(string $key, mixed $default = null): mixed { return $default; }
    }

    class JsonResponse {
        public function __construct(mixed $data = null, int $status = 200) {}
    }
}

namespace Illuminate\Foundation\Http {
    class FormRequest extends \Illuminate\Http\Request {
        public function authorize(): bool { return true; }
        public function rules(): array { return []; }
    }
}

namespace Illuminate\Http\Resources\Json {
    /**
     * @property mixed $id
     * @property mixed $created_at
     * @property mixed $updated_at
     */
    class JsonResource extends \Illuminate\Http\JsonResponse {
        public function __construct(mixed $resource = null) {}
        public static function collection(mixed $resource): static { return new static($resource); }
        public function __get(string $name): mixed { return null; }
    }
}

namespace Illuminate\Database\Eloquent {
    class Model {
        public static function query(): object { return new class {
            public function paginate(int $perPage = 15): array { return []; }
        }; }
        public static function create(array $attributes = []): static { return new static(); }
        public static function findOrFail(mixed $id): static { return new static(); }
        public function update(array $attributes = []): bool { return true; }
        public function delete(): bool { return true; }
    }

    class ModelNotFoundException extends \RuntimeException {}
}

namespace Illuminate\Validation {
    class ValidationException extends \RuntimeException {
        public function errors(): array { return []; }
    }
}

namespace Illuminate\Database\Migrations {
    abstract class Migration {}
}

namespace Illuminate\Database\Schema {
    class Blueprint {
        public function id(): void {}
        public function string(string $column, int $length = 255): self { return $this; }
        public function integer(string $column): self { return $this; }
        public function boolean(string $column): self { return $this; }
        public function dateTime(string $column): self { return $this; }
        public function unsignedBigInteger(string $column): self { return $this; }
        public function foreign(string $column): self { return $this; }
        public function references(string $column): self { return $this; }
        public function on(string $table): self { return $this; }
        public function onDelete(string $action): self { return $this; }
        public function onUpdate(string $action): self { return $this; }
        public function primary(array $columns, ?string $name = null): self { return $this; }
        public function index(array|string $columns, ?string $name = null): self { return $this; }
        public function unique(array|string $columns, ?string $name = null): self { return $this; }
        public function timestamps(): self { return $this; }
        public function nullable(): self { return $this; }
        public function default(mixed $value): self { return $this; }
    }
}

namespace Illuminate\Support\Facades {
    class Schema {
        public static function create(string $table, \Closure $callback): void {}
        public static function dropIfExists(string $table): void {}
    }

    class Route {
        public static function get(string $uri, mixed $action): void {}
        public static function post(string $uri, mixed $action): void {}
        public static function put(string $uri, mixed $action): void {}
        public static function patch(string $uri, mixed $action): void {}
        public static function delete(string $uri, mixed $action): void {}
    }
}

namespace App\Http\Controllers {
    class Controller {}
}

namespace App\Models {
    class Users extends \Illuminate\Database\Eloquent\Model {}
}

namespace {
    function response(mixed $data = null, int $status = 200): object { return new class($data, $status) { public function __construct(public mixed $data, public int $status) {} public function json(mixed $data = null, int $status = 200): object { return new self($data, $status); } }; }
    function report(\Throwable $e): void {}
}
