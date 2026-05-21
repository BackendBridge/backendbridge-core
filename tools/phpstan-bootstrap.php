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
