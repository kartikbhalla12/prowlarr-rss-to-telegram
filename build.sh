#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

# Set variables
TAG="latest"

# Build the Docker image with multi-platform support
echo "Building Docker image..."
docker buildx create --use --name multi-platform-builder || true
docker buildx build --platform linux/amd64,linux/arm64 --tag ${DOCKER_REGISTRY}/${DOCKER_IMAGE_NAME}:${TAG} --push .

# Image is already pushed by buildx with --push flag
echo "Image built and pushed with multi-platform support"

echo "Build and push completed successfully!" 